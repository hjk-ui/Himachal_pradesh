export function PreviewNotice() {
  return (
    <div
      role="status"
      className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"
    >
      <strong>Demo preview · Fictional records</strong>
      <p className="mt-1">
        Create, edit and review sample documentation in this session. Preview changes are kept
        separate from live patient records and reset when the page reloads.
      </p>
    </div>
  );
}
