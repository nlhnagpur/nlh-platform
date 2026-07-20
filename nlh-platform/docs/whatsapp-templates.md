# WhatsApp templates

Template names live in one place: `WA_TEMPLATES` in `src/services/whatsapp.js`.
Changing a template in Meta means changing the name there — nowhere else.

Meta classifies templates by **content, not name**. Anything it rules
*Marketing* is refused delivery to recipients who haven't messaged us in the
last 24 hours (error `131049`), so transactional templates must stay worded as
Utility.

## In use

| Key | Template | Category | Header |
|---|---|---|---|
| `orderInvoiced` | `order_invoiced_v3` | Utility | Image (invoice PNG) |
| `orderDispatched` | `order_dispatched_v2` | Utility | — |
| `studentEnrolled` | `student_enrolled_v2` | Utility | — |
| `balanceReminder` | `balance_reminder` | Utility | — |
| `reviewRequest` | `review_request` | Marketing | — |
| — | `payment_receipt` | Utility | — |

`payment_receipt` serves student fees, franchisee fees and order payments alike.

## Pending: `payment_receipt_v2` (image header)

Receipts are rendered to a PNG (`src/utils/captureReceipt.js`) so the document
itself can be sent, not just the figures. A PNG can only be attached to a
template that declares an **IMAGE header** — sending a header component to a
template without one is rejected by Meta.

Until that template exists, `WA_TEMPLATES.paymentReceiptImage` stays `null` and
receipts send as text. The image is generated and uploaded regardless, so
switching over is a one-line change.

To enable it, create this template in Meta and set the constant to its name:

- **Name:** `payment_receipt_v2`
- **Category:** Utility
- **Header:** Image
- **Body** (same five variables as `payment_receipt`, in the same order):

  ```
  Dear {{1}}, we have received your payment.

  Receipt no: {{2}}
  Amount: {{3}}
  Date: {{4}}
  Status: {{5}}

  The receipt is attached above. Thank you.
  ```

- **Footer:** `Automated message · do not reply · www.nlhnagpur.info`

Keep the variable order identical — `src/services/whatsapp.js` and
`api/send-payment-whatsapp.js` pass the same five for both templates, so no code
changes are needed beyond the constant.
