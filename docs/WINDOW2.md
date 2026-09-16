# Order King Window 2 — Restaurant Partner

Restaurant / vendor operating system for the Order King marketplace.

This window is **not** the full platform. It is the kitchen-facing product, designed to connect to Window 1 (customer), Window 3 (rider), Window 4 (admin/CEO) and Window 5 (shared core).

## What this app is

A mobile-first partner console for small restaurants:

- Sign in (Google, X, or email/password)
- Onboard a real kitchen (stays DRAFT until a platform admin verifies it)
- Or load a labelled **SIMULATED** kitchen to practise the order loop
- Live orders, kitchen mode, menu, availability, hours
- Restaurant-funded vs platform-funded offers
- Settlement in integer paise, exportable as CSV/JSON
- Analytics labelled SIMULATED or REAL
- Assistant that only answers from this restaurant’s authorised numbers
- English / Bengali UI via translation keys

## Local development

The preview starts with `startup.sh` → `npm run dev` on port 8080.

- Postgres: Neon when `DATABASE_URL` is set, otherwise in-memory PGLite
- Auth: real Better Auth. Email/password is enabled
- No `.env` file. Do not add secrets to source

## Environment

Injected by the platform on deploy:

- `DATABASE_URL` — Neon Postgres
- Auth broker credentials
- `HDMASTER_URL` — base URL for the canonical Order King core
- `ROSHOI_SERVICE_TOKEN` — server-only service credential accepted by HDmaster
- `XAI_API_KEY` — optional, server-only assistant

Feature flags and branding live in `src/lib/platform-config.ts` (overridable later via `platform_settings`).

## Data labels

| Label | Meaning |
| --- | --- |
| SIMULATED | Demo kitchen. Never verified. Never shown to customers |
| REAL | An actual restaurant record. Still unverified until admin action |
| VERIFIED | Reserved for platform verification of REAL kitchens |

This app never auto-marks a kitchen VERIFIED.

## RBAC

OWNER, MANAGER, STAFF, ACCOUNTANT, MULTI_OUTLET_MANAGER.

SUPER_ADMIN is platform-only and is not granted here.

Permissions are enforced in server functions (`src/lib/server/isolation.ts`). The UI hides routes; the server still rejects.

Staff cannot read settlements. Accountants cannot accept orders. Restaurant A cannot read Restaurant B (`assertSameRestaurant`).

## Money

All amounts are **integer paise**. See `src/lib/money.ts`.

Payable:

```
food + packing
− restaurant discount
− commission (bps snapshot)
− other authorised deduction (requires a code)
+ platform-funded discount
± refund adjustment
= restaurant payable
```

Historical `order_items` prices are snapshots. Menu edits do not update them.

## Order authority

The canonical LIVE order state is owned by HDmaster. Partner UI labels remain:

`PLACED → ACCEPTED → PREPARING → READY → RIDER_ASSIGNED → PICKED_UP → ON_THE_WAY → DELIVERED`

The Partner adapter maps these labels to the canonical HDmaster order contract. Accept / reject / preparing / ready are sent to HDmaster with an idempotency key and service authentication. The local Partner database is only a projection/cache after HDmaster confirms the transition.

For LIVE orders, READY does **not** create an authoritative local rider queue. HDmaster owns READY → dispatch offer creation.

Simulated rider advancement remains explicitly labelled and is refused outside SIMULATED kitchens.

## Adapters (honest)

| System | Status |
| --- | --- |
| HDmaster order authority | Connected for restaurant transitions |
| In-app notifications | Connected |
| SMS | NOT CONNECTED |
| WhatsApp | NOT CONNECTED |
| Push | NOT CONNECTED |
| Object storage (S3) | NOT CONNECTED (local preview records) |
| Rider dispatch | Owned by HDmaster for LIVE; Partner local queue is non-authoritative |
| Payments | NOT CONNECTED in this window |
| AI | Connected only when `XAI_API_KEY` is present |

## Window 1 contract

Public catalog: `GET /api/v1/catalog`

Returns only `verification_status = VERIFIED` and `data_label in ('REAL','VERIFIED')`.

Menu/price/availability shapes: `src/lib/contracts/index.ts` (`CatalogRestaurant`, `CatalogItem`).

ETA is an estimate from prep minutes, never an exact promise.

## Window 3 contract

LIVE dispatch offers and rider state are owned by HDmaster. Partner must not become the rider/order authority. Simulated rider controls exist only for SIMULATED kitchens.

## Window 4 contract

Admin must be able to verify / reject / suspend, set commission bps, override hours. Those mutations are **not** in this UI. Tables already store `verification_status`, `commission_bps`, `admin_hours_override`.

## Window 5 contract

Typed server functions under `src/lib/server/*` are the vendor API. LIVE order transitions use the HDmaster `/v1/admin/orders/:id/transition` contract with `contractVersion = 1`, actor `restaurant`, `Idempotency-Key`, and service authentication resolved through an existing HDmaster user/workspace.

## Branding

`src/lib/platform-config.ts` — Order King name, logos, colors, legal, support, flags.

Do not scatter brand literals in components. i18n keys in `src/lib/i18n/{en,bn}.ts`. Assamese can be added as a dictionary later.

## Testing

```
npm test
npm run typecheck
npm run build
```

Critical tests: money/paise, state machine, RBAC, isolation, promotion funder split, menu snapshot invariant, hours, and HDmaster transition adapter/idempotency.

## Assumptions

1. Platform stack is TanStack Start (not a separate Next.js app).
2. HDmaster is the canonical LIVE order authority.
3. Commission default is 1000 bps (10%).
4. Tax treatment is stored as snapshot fields and is not invented by this UI.
5. Demo kitchen is per signed-in user and labelled SIMULATED.
