# Cashfree OCC — discovered API contract

**Date:** 2026-08-12
**Status:** Verified live against sandbox. Not from published documentation.

These endpoints back Cashfree's own One Click Checkout UI. They are **internal**
— `/checkout/api/...` is what the hosted checkout page calls from the browser.
There is no published contract, no versioning and no deprecation policy, so
treat every shape here as observed-on-this-date rather than guaranteed.

Everything below was captured by calling sandbox directly, server-side, with no
browser present.

## The key finding

**`x-chxs-id` is the `payment_session_id` returned by Create Order.**

Proven by control: a fresh `payment_session_id` returns 200, and a fabricated
session id returns

```json
{"message":"payment_session_id is not present or is invalid",
 "code":"payment_session_id_invalid","type":"request_failed"}
```

This forces the ordering: **the order is created first, before login.**
Everything downstream is scoped to that session.

## No browser fingerprinting

The captured browser calls carry `cfp_pa_device_id`, `cfg_pa_device_id`,
`forterToken` (Forter fraud detection), `origin`, `referer` and a cookie jar.
**None of it is required.** Header bisection on the address endpoint:

| Headers sent | Result |
|---|---|
| `x-authentication-token` + `x-chxs-id` + `x-customer-phone` | 200 |
| any two of the three | 400 |
| one or none | 400 |

All three are mandatory; nothing else is. Our server can drive these directly.

## Flow

```
UCP cart (Shopify)
  └─► POST /pg/orders  ·  cart_details + products.one_click_checkout
         └─► payment_session_id ──────────────────────────┐
                                                          │ = x-chxs-id
  ├─► POST /checkout/api/auth/initiate                     → OTP sent
  ├─► POST /checkout/api/auth/sessions                     → authentication_token
  ├─► GET  /checkout/api/checkouts/customers/addresses     → saved addresses
  ├─► POST /checkout/api/checkouts/customers/addresses     → create (when none)
  ├─► GET  /checkout/api/checkouts/offers                  → offers, pre-evaluated
  ├─► GET  /checkout/api/checkouts/coupons?coupon=CODE     → validate a code
  └─► cashfreeCheckoutTool({ paymentSessionId, orderId })  → payment
```

## 1. Create Order (public API)

`POST https://sandbox.cashfree.com/pg/orders`
Headers: `x-client-id`, `x-client-secret`, `x-api-version: 2023-08-01`

```json
{
  "order_id": "mcp_demo_...",
  "order_amount": 3600.00,
  "order_currency": "INR",
  "customer_details": {
    "customer_id": "...", "customer_name": "...",
    "customer_email": "...", "customer_phone": "8433719326"
  },
  "order_meta": { "return_url": "https://.../thanks?order_id={order_id}" },
  "products": {
    "one_click_checkout": {
      "enabled": true,
      "conditions": [{ "key": "features", "action": "ALLOW",
        "values": ["checkoutCollectAddress", "checkoutAuthenticate"] }]
    }
  },
  "cart_details": { "cart_items": [ { /* see mapping below */ } ] }
}
```

Response includes `order_id`, `order_status: "ACTIVE"`, `payment_session_id`,
and echoes `cart_details`.

`order_amount` is in **major units** (3600.00), unlike Shopify's minor units.

### Shopify → `cart_items` mapping

Every field is available from UCP; there are no gaps.

| Cashfree | Shopify UCP source |
|---|---|
| `item_id` | `line.item.id` (variant gid) |
| `item_name` | `line.item.title` |
| `item_description` | `product.description.html` |
| `item_details_url` | `https://{shop}/products/{product.handle}` |
| `item_image_url` | `line.item.image_url` |
| `item_original_unit_price` | `variant.list_price` ÷ 100 |
| `item_discounted_unit_price` | `variant.price` ÷ 100 |
| `item_quantity` | `line.quantity` |
| `item_currency` | `cart.currency` |

`handle` and `list_price` are returned by `search_catalog` but are currently
dropped by `src/lib/ucp/normalise.ts` — they need adding.

## 2. Initiate OTP

`POST /checkout/api/auth/initiate`
Headers: `x-chxs-id`, `content-type: application/json`

```json
{ "authentication_type": "OTP", "cf_customer_phone": "8433719326", "source": "ch_x" }
```

Response: `{ "status": true }`

## 3. Verify OTP

`POST /checkout/api/auth/sessions` — same body plus `"otp": "111000"`.

```json
{ "status": true,
  "authentication_token": "df8aa74f-....._.ch_x",
  "customer_uid": "83d7b6bd-249f-11ee-9ccf-023177151620" }
```

`authentication_token` becomes `x-authentication-token` on every later call.
Sandbox OTP is `111000`.

## 4. Addresses

`GET /checkout/api/checkouts/customers/addresses`
Headers: `x-authentication-token`, `x-chxs-id`, `x-customer-phone` (E.164 with
a space, e.g. `+91 8433719326`)

```json
{ "addresses": [ {
  "id": "1054210", "customer_name": "kishan",
  "address_line_one": "...", "address_line_two": "",
  "city": "Koramangala Bangalore",
  "state": "Karnataka", "state_code": "KA",
  "country": "India", "country_code": "IN",
  "zip_code": "560034",
  "phone": "+91 8433719326", "email": "kishan.maurya@cashfree.com" } ] }
```

`POST` to the same path creates one:

```json
{ "shipping_address": { "customer_name", "address_line_one", "address_line_two",
    "city", "zip_code", "country", "country_code", "state", "state_code",
    "email", "phone", "type": "SHIPPING_ADDRESS" },
  "billing_address": { /* same shape */ },
  "is_guest": false }
```

## 5. Offers

`GET /checkout/api/checkouts/offers` — same three headers. Returns an **array**
(not an object), each entry already priced against this order:

```json
{ "offerId": "e9dfbb87-...", "code": "CF40", "title": "Cashfree Offer",
  "description": "Flat 40 dicount", "type": "DISCOUNT", "status": "ACTIVE",
  "tnc": "...", "tncType": "TEXT",
  "startTime": "...", "endTime": "...",
  "paymentMethod": "ALL", "isAutoApplyOffer": false,
  "validations": [
    { "name": "MIN_ORDER_AMOUNT", "value": { "minAmount": 500 } },
    { "name": "MAX_ALLOWED_REDEMPTIONS", "value": { "maxAllowed": 10000 } } ],
  "offerEvaluations": [
    { "type": "DISCOUNT", "offerValue": 40, "offerValueType": "FLAT",
      "maxOfferAmount": 40 } ],
  "evaluatedOffer": {
    "initialPayableAmount": 3600,
    "newPayableAmount": 3560,
    "breakups": [ { "type": "DISCOUNT", "amount": 40 } ] } }
```

**`evaluatedOffer` is the important part**: Cashfree has already applied each
offer to this order's amount, so the widget renders `newPayableAmount` directly
and computes nothing. Amounts here are in **major units**.

`GET /checkout/api/checkouts/coupons?coupon=CF40` validates a manually typed
code and returns `{ "offerDetails": [ /* same shape */ ] }`. Omitting the
parameter returns `{"code":"coupon_missing"}`.

## Open question

**How a selected address attaches to the order is not yet established.**
`POST …/addresses` adds one to the customer's address book, but nothing observed
so far marks one as *this order's* shipping address, and the GET returns several
with no selection field. Options to test: a PATCH/PUT on the order, an extra
field at payment time, or the hosted checkout picking the most recent. This must
be resolved before the address step can be considered done.

## Cautions

- **Internal endpoints.** No contract, no versioning. Confirm with the OCC team
  before anything beyond a demo depends on them.
- **Do not commit tokens.** `authentication_token`, `payment_session_id` and
  `customer_uid` are per-session secrets. They belong in `.env`, and unlike the
  Shopify work these responses must **not** be committed as test fixtures — the
  fixtures for these tests are hand-written and redacted.
- **Two money formats.** Shopify UCP is minor units with cart-level currency;
  Cashfree is major units per field. The boundary is the mapping above.
