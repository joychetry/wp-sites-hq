//! A WooCommerce store on one site: its overview for a period, its products a
//! page at a time, and price and stock changes (Classic Monks `list-products`,
//! `get-store-overview`, `update-products`). Changes run as jobs.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::Core;
use crate::connect::{SiteError, plain};
use crate::fleet::{Action, has_tool};
use crate::sites::Mode;

pub const NEEDS_WOO: &str = "This site has no WooCommerce store that Monks Central can read. It needs WooCommerce and an up to date Classic Monks.";

/// A product as the site stores it. Prices are WooCommerce's strings, "" when unset.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Product {
    pub id: i64,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub status: String,
    pub sku: String,
    pub price: String,
    pub regular_price: String,
    pub sale_price: String,
    pub stock_status: String,
    pub manage_stock: bool,
    pub stock_quantity: Option<i64>,
    pub permalink: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Products {
    pub products: Vec<Product>,
    pub total: i64,
    pub pages: i64,
    pub currency: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ProductQuery {
    pub search: Option<String>,
    /// publish, draft, pending, private or any.
    pub status: Option<String>,
    /// instock, outofstock or onbackorder.
    pub stock_status: Option<String>,
    pub page: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct LowStock {
    pub id: i64,
    pub name: String,
    pub stock_quantity: i64,
}

/// Paid orders and revenue (less refunds) between two days, as the site counts them.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Overview {
    pub currency: String,
    pub from: String,
    pub to: String,
    pub orders: i64,
    pub revenue: String,
    pub average_order: String,
    pub by_status: BTreeMap<String, i64>,
    pub low_stock: Vec<LowStock>,
    pub out_of_stock: i64,
    pub processing: i64,
}

/// "12", "12.5", "12.50": WooCommerce's own format. "" clears a sale price.
fn is_price(p: &str) -> bool {
    let mut parts = p.splitn(2, '.');
    let whole = parts.next().unwrap_or_default();
    let cents = parts.next();
    !whole.is_empty()
        && whole.len() <= 9
        && whole.bytes().all(|b| b.is_ascii_digit())
        && cents
            .is_none_or(|c| !c.is_empty() && c.len() <= 4 && c.bytes().all(|b| b.is_ascii_digit()))
}

/// Errs with what's wrong with a product change before it reaches a site.
pub(crate) fn check_product(action: &Action) -> Result<(), String> {
    let Action::UpdateProduct {
        regular_price,
        sale_price,
        stock_quantity,
        ..
    } = action
    else {
        return Ok(());
    };
    if regular_price.is_none() && sale_price.is_none() && stock_quantity.is_none() {
        return Err("Change a price or the stock.".into());
    }
    if regular_price.as_deref().is_some_and(|p| !is_price(p)) {
        return Err("Write the price as a number, like 12.50.".into());
    }
    if sale_price
        .as_deref()
        .is_some_and(|p| !p.is_empty() && !is_price(p))
    {
        return Err("Write the sale price as a number, like 9.99, or leave it empty.".into());
    }
    if stock_quantity.is_some_and(|q| !(-1_000_000..=1_000_000_000).contains(&q)) {
        return Err("The stock is out of range.".into());
    }
    Ok(())
}

impl Core {
    fn shop_site(&self, id: i64, tool: &str) -> Result<(), SiteError> {
        let site = self.site(id)?;
        if site.mode != Mode::ClassicMonks || !has_tool(&site, tool) {
            return Err(plain(NEEDS_WOO));
        }
        Ok(())
    }

    pub async fn products(&self, id: i64, q: &ProductQuery) -> Result<Products, SiteError> {
        let _work = self.working().await;
        self.shop_site(id, "list-products")?;
        let mut args = json!({ "page": q.page.unwrap_or(1).max(1), "per_page": 50 });
        for (key, v) in [
            ("search", &q.search),
            ("status", &q.status),
            ("stock_status", &q.stock_status),
        ] {
            if let Some(v) = v.as_deref().filter(|v| !v.is_empty()) {
                args[key] = json!(v);
            }
        }
        let v = self.call_ability_inner(id, "list-products", args).await?;
        serde_json::from_value(v)
            .map_err(|e| plain(format!("The site's product list didn't make sense: {e}")))
    }

    /// The store over `days` days to today, or `from`..=`to` ("YYYY-MM-DD").
    pub async fn store_overview(
        &self,
        id: i64,
        days: u32,
        range: Option<(&str, &str)>,
    ) -> Result<Overview, SiteError> {
        let _work = self.working().await;
        self.store_overview_inner(id, days, range).await
    }

    pub(crate) async fn store_overview_inner(
        &self,
        id: i64,
        days: u32,
        range: Option<(&str, &str)>,
    ) -> Result<Overview, SiteError> {
        self.shop_site(id, "get-store-overview")?;
        let args = match range {
            Some((from, to)) => json!({ "from": from, "to": to }),
            None => json!({ "days": days.clamp(1, 366) }),
        };
        let v = self
            .call_ability_inner(id, "get-store-overview", args)
            .await?;
        serde_json::from_value(v)
            .map_err(|e| plain(format!("The site's store overview didn't make sense: {e}")))
    }

    pub(crate) async fn run_product(&self, id: i64, action: &Action) -> Result<String, SiteError> {
        let Action::UpdateProduct {
            product_id,
            regular_price,
            sale_price,
            stock_quantity,
            ..
        } = action
        else {
            return Err(plain("Not a product change."));
        };
        check_product(action).map_err(plain)?;
        self.shop_site(id, "update-products")?;
        let mut item = json!({ "id": product_id });
        if let Some(p) = regular_price {
            item["regular_price"] = json!(p);
        }
        if let Some(p) = sale_price {
            item["sale_price"] = json!(p);
        }
        if let Some(q) = stock_quantity {
            item["manage_stock"] = json!(true);
            item["stock_quantity"] = json!(q);
        }
        let out = self
            .call_ability_inner(id, "update-products", json!({ "products": [item] }))
            .await?;
        let r = &out["results"][0];
        if r["success"] != true {
            let why = r["error"]
                .as_str()
                .filter(|e| !e.is_empty())
                .unwrap_or("the site didn't say why");
            return Err(plain(format!("Not changed: {why}.")));
        }
        Ok(product_message(r))
    }
}

fn product_message(r: &Value) -> String {
    let fields: Vec<&str> = r["updated_fields"]
        .as_array()
        .map(|f| f.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let words: Vec<&str> = fields
        .iter()
        .filter_map(|f| match *f {
            "regular_price" => Some("price"),
            "sale_price" => Some("sale price"),
            "stock_quantity" => Some("stock"),
            _ => None,
        })
        .collect();
    if words.is_empty() {
        "Nothing needed changing.".into()
    } else {
        format!("Changed the {}.", words.join(" and "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use crate::fleet::{Change, Job};
    use crate::testsite::TestSite;
    use std::sync::Arc;

    async fn core() -> (tempfile::TempDir, Arc<Core>) {
        let home = tempfile::tempdir().unwrap();
        let opts = Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            ..Default::default()
        };
        let core = Core::start(home.path(), opts).await.unwrap();
        (home, core)
    }

    fn browser(url: &str) -> std::io::Result<()> {
        let url = url.to_string();
        tokio::spawn(async move { reqwest::get(url).await });
        Ok(())
    }

    async fn wait(core: &Core, job: i64) -> Job {
        for _ in 0..200 {
            let j = core.job(job).unwrap();
            if j.finished_at.is_some() {
                return j;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("job {job} didn't finish");
    }

    fn change(
        product_id: i64,
        price: Option<&str>,
        sale: Option<&str>,
        stock: Option<i64>,
    ) -> Action {
        Action::UpdateProduct {
            product_id,
            name: "Sourdough".into(),
            regular_price: price.map(Into::into),
            sale_price: sale.map(Into::into),
            stock_quantity: stock,
        }
    }

    #[test]
    fn prices_are_checked_before_they_reach_a_site() {
        for ok in ["12", "12.5", "0.99", "123456789.1234"] {
            assert!(is_price(ok), "{ok}");
        }
        for bad in ["", ".5", "1.", "1,50", "-3", "1e3", "1.23456", "1234567890"] {
            assert!(!is_price(bad), "{bad}");
        }
        assert!(check_product(&change(1, Some("4.50"), Some(""), Some(3))).is_ok());
        assert_eq!(
            check_product(&change(1, None, None, None)).unwrap_err(),
            "Change a price or the stock."
        );
        assert!(check_product(&change(1, Some("four"), None, None)).is_err());
        assert!(check_product(&change(1, None, Some("x"), None)).is_err());
        assert!(check_product(&change(1, None, None, Some(-2_000_000))).is_err());
    }

    #[tokio::test]
    async fn a_store_is_read_and_its_products_change_as_a_job() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();

        let all = core.products(s.id, &ProductQuery::default()).await.unwrap();
        assert_eq!(all.currency, "EUR");
        assert_eq!(all.products.len(), 2);
        let found = core
            .products(
                s.id,
                &ProductQuery {
                    search: Some("sour".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(found.products.len(), 1);
        assert_eq!(found.products[0].regular_price, "4.50");
        assert_eq!(site.state().calls.last().unwrap().1["search"], "sour");

        let o = core.store_overview(s.id, 30, None).await.unwrap();
        assert_eq!(
            (o.orders, o.revenue.as_str(), o.processing),
            (3, "120.00", 1)
        );
        assert_eq!(o.low_stock[0].name, "Rye");
        core.store_overview(s.id, 30, Some(("2026-09-01", "2026-09-30")))
            .await
            .unwrap();
        assert_eq!(
            site.state().calls.last().unwrap().1,
            json!({ "from": "2026-09-01", "to": "2026-09-30" })
        );

        let id = found.products[0].id;
        let job = core
            .start_job(
                "Change Sourdough",
                vec![Change {
                    site_id: s.id,
                    action: change(id, Some("5.00"), Some(""), Some(12)),
                }],
            )
            .await
            .unwrap();
        let done = wait(&core, job.id).await;
        assert_eq!(
            done.items[0].message, "Changed the price and sale price and stock.",
            "{done:?}"
        );
        let p = &core
            .products(s.id, &ProductQuery::default())
            .await
            .unwrap()
            .products;
        let p = p.iter().find(|p| p.id == id).unwrap();
        assert_eq!(
            (
                p.regular_price.as_str(),
                p.sale_price.as_str(),
                p.stock_quantity
            ),
            ("5.00", "", Some(12))
        );

        // A bad price never reaches the site; a site without the store says so.
        let calls = site.state().calls.len();
        let job = core
            .start_job(
                "Bad",
                vec![Change {
                    site_id: s.id,
                    action: change(id, Some("five"), None, None),
                }],
            )
            .await
            .unwrap();
        assert!(
            wait(&core, job.id).await.items[0]
                .message
                .contains("like 12.50")
        );
        assert_eq!(site.state().calls.len(), calls);
        site.state().no_woo = true;
        core.check_site(s.id).await;
        assert_eq!(
            core.products(s.id, &ProductQuery::default())
                .await
                .unwrap_err()
                .to_string(),
            NEEDS_WOO
        );
    }
}
