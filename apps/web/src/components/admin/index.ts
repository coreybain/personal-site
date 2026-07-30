/**
 * The admin kit, as pages are meant to see it.
 *
 * Import from `@/components/admin` rather than from the individual files. Two
 * reasons: it keeps a page's import block to one line per concern, and it means
 * the kit can be reorganised (a file split, a component renamed internally)
 * without touching nine screens.
 *
 * `README.md` in this directory is the documentation. It is written for whoever
 * is building an entity screen and covers the composition order pages must use —
 * page furniture outside the Convex gate, hooks inside it — which is the one rule
 * that cannot be recovered from the type signatures.
 *
 * **Nothing on the public site may import from this directory.** The kit pulls in
 * `@clerk/nextjs`, `convex/react` and `@uploadthing/react`; the reason
 * `ConvexClientProvider` moved out of the root layout is that those three cost
 * ~76 KB gzip in whatever route's client graph they land in, against a < 100 KB
 * homepage budget that phase 3 enforces in CI. See `src/app/layout.tsx`.
 */

/* ── Chrome (used by the shell layout, not by pages) ─────────────────────── */
export { AdminShell } from "./AdminShell";
export { AdminNav } from "./AdminNav";
export { AdminBreadcrumb } from "./AdminBreadcrumb";
export { AdminStatusStrip } from "./AdminStatusStrip";
export { AdminSignOut } from "./AdminSignOut";

/* ── Section registry ────────────────────────────────────────────────────── */
export {
  ADMIN_GROUPS,
  ADMIN_SECTIONS,
  sectionForPathname,
  type AdminSection,
  type AdminSectionId,
} from "./sections";

/* ── Deployment facts ────────────────────────────────────────────────────── */
export {
  AdminConfigProvider,
  useAdminConfig,
  type AdminConfig,
} from "./AdminConfig";
export { CONVEX_READY, useConvexReady } from "./useConvexReady";
export { ConvexGate, ConvexNotConfigured } from "./ConvexGate";

/* ── Page furniture ──────────────────────────────────────────────────────── */
export {
  AdminButtonRow,
  AdminForm,
  AdminNotice,
  AdminPage,
  AdminPageHeader,
  AdminPanel,
  type AdminPageHeaderProps,
} from "./AdminPage";

/* ── Orientation: what is this, where is back, where is it live ──────────── */
export { InfoTip, type InfoTipProps } from "./InfoTip";
export { BackLink, type BackLinkProps } from "./BackLink";
export { ViewOnSite, ViewSiteLink, type ViewOnSiteProps } from "./ViewOnSite";

/* ── Form primitives ─────────────────────────────────────────────────────── */
export {
  DateField,
  Field,
  FieldRow,
  InstantField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  ToggleField,
  type DateFieldProps,
  type FieldProps,
  type InstantFieldProps,
  type NumberFieldProps,
  type SelectFieldProps,
  type SelectOption,
  type TextAreaFieldProps,
  type TextFieldProps,
  type ToggleFieldProps,
} from "./Field";
export {
  SlugField,
  isValidSlug,
  slugify,
  type SlugFieldProps,
} from "./SlugField";

/* ── Long-form content ───────────────────────────────────────────────────── */
export {
  RichTextEditor,
  findUnsupportedMarkdown,
  type RichTextEditorProps,
} from "./RichTextEditor";

/* ── Actions ─────────────────────────────────────────────────────────────── */
export {
  ActionButton,
  DeleteButton,
  SaveButton,
  type ActionButtonProps,
  type DeleteButtonProps,
  type SaveButtonProps,
} from "./Buttons";
export {
  describeFailure,
  usePendingAction,
  type ActionFailure,
  type PendingAction,
} from "./usePendingAction";

/* ── Lists ───────────────────────────────────────────────────────────────── */
export {
  EntityTable,
  RowActions,
  ToolbarEnd,
  type EntityColumn,
  type EntityTableProps,
} from "./EntityTable";
export { Badge, StatusBadge } from "./StatusBadge";

/* ── Media ───────────────────────────────────────────────────────────────── */
export { ImageUpload, type ImageUploadProps } from "./ImageUpload";
export {
  MediaListEditor,
  type MediaListEditorProps,
} from "./MediaListEditor";

/* ── Dates ───────────────────────────────────────────────────────────────── */
export {
  formatInstant,
  formatMonth,
  inputToIsoDate,
  isIsoDate,
  isIsoInstant,
  isoDateToInput,
  isoInstantToLocalInput,
  localInputToIsoInstant,
  nowIso,
} from "./datetime";
