/**
 * Launch feature flags.
 *
 * `SALES_REPS_ENABLED` — master switch for the multi-user / sales-representative
 * experience in the **UI**. The initial production launch is Owner-only (exactly
 * one user), so this is `false`: rep assignment controls, rep management, and
 * rep-specific columns/filters are hidden throughout the app.
 *
 * This flag is presentation-only. It deliberately does NOT touch — and must never
 * be used to weaken — the role-based database security that always stays on:
 * RLS policies, column masking (`app.is_admin()`), the `sales_rep` role, and the
 * row-scoped views/RPCs. Those remain fully intact so multi-user support is a
 * config flip, not a rebuild.
 *
 * To enable the full multi-user experience post-launch (after reps are
 * provisioned and the sales-rep login flow has been validated — see the
 * "Future multi-user / sales-rep checks" section of docs/M7_LAUNCH_READINESS.md):
 * set this to `true`. No schema change is required.
 *
 * Kept as a hard-coded constant (rather than an env var) so it cannot be flipped
 * on in production by accident; internal/staging builds can set it to `true` to
 * exercise the rep UI.
 */
export const SALES_REPS_ENABLED = false;
