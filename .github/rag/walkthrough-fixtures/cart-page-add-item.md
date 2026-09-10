---
id: cart-page-add-item
title: Add a product to the shopping cart from the product listing page
tags: [cart, checkout, ui, page object, ecommerce]
automationMode: [ui]
language: [python]
imports:
  python: ["testkit.pages.cart_page.CartPage"]
---

Use: Reach for this whenever a UI scenario needs an item already in the cart before continuing (e.g. before testing checkout), instead of re-writing the "find product, click Add to Cart" steps.
Requires: A Playwright Page already on the product listing page showing the target product (see CartPage's own constructor).
API: def add_item_to_cart(self, product_name: str) -> None

```python
cart_page.add_item_to_cart("Wireless Mouse")
```
