"use client";

import { api } from "@home/convex/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";

import {
  AdminButtonRow,
  AdminForm,
  AdminNotice,
  AdminPanel,
  Badge,
  EntityTable,
  Field,
  RowActions,
  SaveButton,
  TextField,
  formatInstant,
  usePendingAction,
} from "@/components/admin";

/**
 * The ingest-token screen: issue, reveal once, list, revoke.
 *
 * ── The one rule this screen exists to enforce ──────────────────────────────
 *
 * `ingestTokens.issue` returns the plaintext token in its response and nowhere
 * else. The row stores a SHA-256 hash, and `ingestTokens.list` projects its fields
 * one by one specifically so that the hash cannot reach the browser (see the
 * docblock on that query). So this component holds the plaintext in React state
 * for exactly as long as the tab lives, shows it in a panel that says so in as
 * many words, and offers a clipboard copy — because the realistic alternative is
 * someone re-typing 64 hex characters and getting a 401 they cannot debug.
 *
 * The state deliberately does **not** persist: no `sessionStorage`, no URL
 * parameter, no re-render survival across a navigation. A token that outlives the
 * moment of issuing is a secret in a place nobody is auditing.
 *
 * ── Why the issue form is not a `<form>` ────────────────────────────────────
 *
 * Same reason as every other admin screen: `SaveButton` calls the mutation
 * directly and the kit's fields do not validate, so there is nothing for a submit
 * handler or `preventDefault` to do. Bounds and the "at least one scope" rule live
 * in the mutation (`ingestTokens.issue`), which is the only place that can be
 * authoritative, and its `failure.message` is rendered where it happened.
 */

/* ------------------------------------------------------------------ *
 * Scopes
 * ------------------------------------------------------------------ */

/**
 * The three scopes of `IngestScopeSchema`, with the machine each one is for.
 *
 * Hand-mirrored from the `ingestScope` validator in `convex/schema.ts` rather than
 * derived from it: the *labels* are the point of this list, and a scope added
 * there without a line here shows up as a checkbox the admin cannot explain. The
 * union type below is what makes a typo a build failure — `scopes` on
 * `ingestTokens.issue` is typed to the union, so a fourth value invented here
 * fails `tsc` at the call site.
 */
const SCOPES = [
  {
    value: "ai-usage:write",
    label: "ai-usage:write",
    blurb: "The Claude/Codex session collector on the MacBook (ADR 007).",
  },
  {
    value: "health:write",
    label: "health:write",
    blurb: "The iOS app's HealthKit export.",
  },
  {
    value: "git:write",
    label: "git:write",
    blurb: "The GitHub contribution stats push (ADR 008).",
  },
] as const satisfies readonly {
  value: "ai-usage:write" | "health:write" | "git:write";
  label: string;
  blurb: string;
}[];

type IngestScope = (typeof SCOPES)[number]["value"];

/** What `issue` handed back, for as long as this tab stays open. */
type IssuedToken = {
  name: string;
  scopes: readonly IngestScope[];
  token: string;
};

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function TokensScreen() {
  const rows = useQuery(api.ingestTokens.list, {});

  /**
   * Lifted above the form so that resetting the form's fields after a successful
   * issue does not take the reveal panel with it. Cleared only by the panel's own
   * "I have stored it" button, so the token never disappears from under someone
   * who is mid-copy.
   */
  const [issued, setIssued] = useState<IssuedToken | null>(null);

  return (
    <>
      {issued ? (
        <IssuedTokenPanel issued={issued} onDismiss={() => setIssued(null)} />
      ) : null}

      <IssueForm onIssued={setIssued} />

      <TokenTable rows={rows} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The one-time reveal
 * ------------------------------------------------------------------ */

/**
 * The token, once.
 *
 * A read-only `<input>` rather than a `<code>` block, and that is a considered
 * choice: an input is focusable, its whole value is selected by a single
 * `select()` or a triple-click, and it works on iOS where selecting text inside a
 * block element is fiddly. The clipboard button is the happy path; the input is
 * what makes the panel usable when `navigator.clipboard` is unavailable, which is
 * every browsing context that is not HTTPS or localhost.
 *
 * `spellCheck={false}` and `autoComplete="off"` because a password manager
 * offering to remember 64 hex characters as a username is not helpful.
 */
function IssuedTokenPanel({
  issued,
  onDismiss,
}: {
  issued: IssuedToken;
  onDismiss: () => void;
}) {
  return (
    <AdminPanel
      title="Copy this now"
      headerEnd={
        <span className="adm-eyebrow">{issued.scopes.join(", ")}</span>
      }
      footer={
        <AdminButtonRow>
          <CopyButton value={issued.token} />
          <button type="button" className="adm-btn" onClick={onDismiss}>
            I have stored it — hide
          </button>
        </AdminButtonRow>
      }
    >
      <AdminNotice tone="danger" title="You will not see this token again">
        Only a SHA-256 hash of it is stored, so there is no &ldquo;show
        again&rdquo; and no recovery — a lost token is revoked and reissued. Put it
        straight into the machine that needs it (a keychain entry, a{" "}
        <code>.env</code> on the collector host), never into a note or a chat.
      </AdminNotice>

      <Field
        label={`Token for “${issued.name}”`}
        hint="Send it as an Authorization: Bearer header on every ingest request."
      >
        {({ id, describedBy }) => (
          <input
            id={id}
            className="adm-input adm-mono"
            type="text"
            value={issued.token}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={describedBy}
          />
        )}
      </Field>
    </AdminPanel>
  );
}

/**
 * Clipboard copy, with a two-second acknowledgement.
 *
 * Not an `ActionButton`: that component reports failure but has no success
 * affordance, and "did the copy work?" is the entire question here — the token is
 * about to be hidden forever, so a silent button is worse than no button. Not a
 * `SaveButton` either, because its label and its "Saved" wording are about writes.
 *
 * The `catch` matters. `navigator.clipboard` is undefined outside a secure
 * context, and `writeText` rejects when the document is not focused or permission
 * is denied. Either way the honest response is to say so and point at the input
 * above, which is still selectable.
 */
function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  /* Cleared on unmount, which happens the moment "I have stored it" is pressed.
     Setting state after unmount is a silent no-op in React 19, so this is hygiene
     rather than a bug fix — the same reasoning as the timer in the kit's
     `usePendingAction`. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  return (
    <span className="adm-btn-row">
      <button
        type="button"
        className="adm-btn"
        data-variant="primary"
        onClick={() => {
          void (async () => {
            try {
              await navigator.clipboard.writeText(value);
              setState("copied");
              timer.current = setTimeout(() => setState("idle"), 2200);
            } catch {
              setState("failed");
            }
          })();
        }}
      >
        Copy token
      </button>

      {state === "copied" ? (
        <span className="adm-btn-note" data-tone="ok" role="status">
          Copied
        </span>
      ) : null}

      {state === "failed" ? (
        <span className="adm-btn-note" data-tone="error" role="alert">
          The clipboard is unavailable here — select the field above and copy
          manually.
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Issue
 * ------------------------------------------------------------------ */

function IssueForm({ onIssued }: { onIssued: (issued: IssuedToken) => void }) {
  const issue = useMutation(api.ingestTokens.issue);
  const action = usePendingAction();

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<readonly IngestScope[]>([]);

  const toggle = (scope: IngestScope, on: boolean) => {
    setScopes((current) =>
      on
        ? current.includes(scope)
          ? current
          : [...current, scope]
        : current.filter((value) => value !== scope),
    );
  };

  return (
    <AdminPanel
      title="Issue a token"
      /* Both field hints moved in here. Neither was something a reader has to act
         on before pressing the button — one is advice about naming, the other is
         the reasoning behind ADR 006a's narrow scopes — and between them they put
         four lines of prose above a form of two controls. The `error`s stay where
         they are: those come from the mutation, name the field they are about, and
         are the only text on this form that appears because something went wrong.

         Note what did *not* move: everything in `IssuedTokenPanel`. */
      infoLabel="About names and scopes"
      info={
        <>
          The name&rsquo;s only job is making &ldquo;which one do I
          revoke?&rdquo; answerable in a year, so name the machine rather than the
          purpose. Give each source only the scopes it pushes: one all-scope token
          defeats the point of ADR 006a, because revoking the phone would stop the
          collector too.
        </>
      }
      footer={
        <SaveButton
          label="Issue token"
          action={action}
          /* `dirty` is doing duty as "is this form answerable at all". The
             mutation refuses a blank name and an empty scope list with a proper
             message, so this is a courtesy that saves a round trip, not a
             validation — see the kit README on why no field validates. */
          dirty={name.trim().length > 0 && scopes.length > 0}
          onAction={async () => {
            const result = await issue({ name: name.trim(), scopes: [...scopes] });

            /* Reset the form, keep the reveal. The panel is rendered by the
               parent from this value precisely so that this reset cannot clear
               it. */
            setName("");
            setScopes([]);
            onIssued({
              name: result.name,
              scopes: result.scopes,
              token: result.token,
            });
          }}
        />
      }
    >
      <AdminForm>
        <TextField
          label="Name"
          value={name}
          onValueChange={setName}
          required
          maxLength={80}
          placeholder="MacBook collector"
          error={action.failure?.field === "name" ? action.failure.message : null}
        />

        <Field
          label="Scopes"
          required
          error={
            action.failure?.field === "scopes" ? action.failure.message : null
          }
        >
          {() => (
            /* Real checkboxes via the kit's toggle, one per scope. Not a
               multi-`<select>`: three closed options, each needing a sentence of
               explanation, is a checkbox list in every design system that has
               thought about it. */
            <div className="adm-form">
              {SCOPES.map((scope) => (
                <ToggleRow
                  key={scope.value}
                  label={scope.label}
                  blurb={scope.blurb}
                  checked={scopes.includes(scope.value)}
                  onCheckedChange={(on) => toggle(scope.value, on)}
                />
              ))}
            </div>
          )}
        </Field>
      </AdminForm>
    </AdminPanel>
  );
}

/**
 * One scope checkbox.
 *
 * A local component rather than the kit's `ToggleField` for one reason: the label
 * here is a scope string and wants the mono treatment, and `ToggleField` renders
 * its label as plain text. Everything else — the hidden native checkbox, the
 * drawn track, the whole thing being one `<label>` — is the kit's markup,
 * reproduced so the two look identical.
 */
function ToggleRow({
  label,
  blurb,
  checked,
  onCheckedChange,
}: {
  label: string;
  blurb: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="adm-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span className="adm-toggle-track" aria-hidden="true">
        <span className="adm-toggle-thumb" />
      </span>
      <span className="adm-toggle-copy">
        <span className="adm-toggle-label adm-mono">{label}</span>
        <span className="adm-hint">{blurb}</span>
      </span>
    </label>
  );
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

/**
 * The shape `ingestTokens.list` projects. Note the absent `hashedToken` — the
 * type is derived from the query rather than re-declared precisely so that a
 * future field added to that projection appears here without anyone deciding to
 * add it, and a field removed from it fails the build at the cell that read it.
 */
type TokenRow = FunctionReturnType<typeof api.ingestTokens.list>[number];

function TokenTable({ rows }: { rows: readonly TokenRow[] | undefined }) {
  const revoke = useMutation(api.ingestTokens.revoke);

  const live = rows?.filter((row) => row.revokedAt === null).length ?? 0;

  return (
    <AdminPanel
      title="Issued tokens"
      /* The two facts this table's *shape* raises and cannot answer: why there is
         no token column, and why revoked rows are still here. Both were only ever
         in code comments and in the page's old description paragraph. The tip
         sits beside the title (`info`), not in `headerEnd` — that slot keeps only
         the live/revoked count. */
      infoLabel="About this list"
      info={
        <>
          The token itself is not in here and cannot be:{" "}
          <code>ingestTokens.list</code> projects its fields one by one so the
          stored SHA-256 hash never reaches the browser. Revoking is a tombstone
          rather than a delete — the row stays forever, so &ldquo;the collector
          stopped pushing on the 14th&rdquo; still has an explanation six months
          later.
        </>
      }
      headerEnd={
        rows === undefined ? null : (
          <span className="adm-eyebrow">
            {live} live · {rows.length - live} revoked
          </span>
        )
      }
    >
      <EntityTable
        columns={[
          { key: "name", label: "Name" },
          { key: "scopes", label: "Scopes" },
          { key: "issued", label: "Issued" },
          { key: "lastUsed", label: "Last used" },
          { key: "state", label: "State" },
          { key: "actions", label: "", align: "right" },
        ]}
        loading={rows === undefined}
        empty={rows?.length === 0}
        emptyTitle="No tokens issued"
        emptyBody="Nothing can push to the ingest endpoints until one exists. Issue the first above."
      >
        {rows?.map((row) => {
          const revoked = row.revokedAt !== null;

          return (
            <tr key={row._id}>
              <td>
                <span className="adm-cell-primary">{row.name}</span>
              </td>

              <td>
                {/* Every scope, every time. A truncated list on the screen whose
                    job is answering "what can this machine do?" is worse than a
                    wide column. */}
                <span className="adm-mono adm-micro">
                  {row.scopes.join(", ")}
                </span>
              </td>

              <td data-numeric="true">{formatInstant(row.issuedAt)}</td>

              <td data-numeric="true">
                {/* `null` is a fact, not a gap: "issued and never used" is the
                    liveness signal ADR 006a asks this list to carry, so it gets a
                    word rather than an em dash. */}
                {row.lastUsedAt === null ? (
                  <span className="adm-micro">never used</span>
                ) : (
                  formatInstant(row.lastUsedAt)
                )}
              </td>

              <td>
                {revoked ? (
                  <Badge tone="revoked">revoked</Badge>
                ) : (
                  <Badge tone="published">live</Badge>
                )}
              </td>

              <td data-align="right">
                <RowActions>
                  {revoked ? (
                    <span
                      className="adm-micro"
                      title={`Revoked ${formatInstant(row.revokedAt)}`}
                    >
                      {formatInstant(row.revokedAt)}
                    </span>
                  ) : (
                    /* `DeleteButton`'s two-click arm, used for a revoke. The
                       button is not deleting anything — revocation is a
                       tombstone, the row stays forever so that "the collector
                       stopped pushing on the 14th" has an explanation — but it
                       *is* irreversible and instant, so it wants exactly the
                       confirmation the kit already implements. A modal for one
                       click in a table row is the thing the kit declined to
                       build. */
                    <RevokeButton
                      name={row.name}
                      onRevoke={() => revoke({ tokenId: row._id })}
                    />
                  )}
                </RowActions>
              </td>
            </tr>
          );
        })}
      </EntityTable>
    </AdminPanel>
  );
}

/** How long the armed state lasts before disarming itself. The kit's `ARM_MS`. */
const ARM_MS = 4000;

/**
 * Revoke, behind one extra click.
 *
 * The kit's `DeleteButton` markup and behaviour — two-click arm, four-second
 * self-disarm, no modal — with different words, and the words are the reason this
 * is not just `DeleteButton`. Revocation is a tombstone: `ingestTokens.revoke`
 * sets `revokedAt` and the row stays forever, so that "the collector stopped
 * pushing on the 14th" still has an explanation six months later. A button
 * labelled "Delete" would suggest the audit trail goes with it.
 *
 * The mutation is idempotent, so an armed button clicked from a stale tab against
 * an already-revoked token reports success and changes nothing.
 */
function RevokeButton({
  name,
  onRevoke,
}: {
  name: string;
  onRevoke: () => Promise<unknown>;
}) {
  const [armed, setArmed] = useState(false);
  const action = usePendingAction();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!armed) {
      return;
    }

    timer.current = setTimeout(() => setArmed(false), ARM_MS);

    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [armed]);

  return (
    <span className="adm-btn-row">
      <button
        type="button"
        className="adm-btn"
        data-variant="danger"
        data-size="sm"
        data-armed={armed ? "true" : undefined}
        disabled={action.pending}
        aria-busy={action.pending || undefined}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }

          setArmed(false);
          void action.run(onRevoke);
        }}
      >
        {action.pending ? (
          <span className="adm-spinner" aria-hidden="true" />
        ) : null}
        {action.pending
          ? "Revoking…"
          : armed
            ? `Revoke “${name}” — sure?`
            : "Revoke"}
      </button>

      {action.failure ? (
        <span className="adm-btn-note" data-tone="error" role="alert">
          {action.failure.message}
        </span>
      ) : null}
    </span>
  );
}
