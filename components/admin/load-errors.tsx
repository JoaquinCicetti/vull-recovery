// Surfaced in the UI on purpose: a swallowed query error is exactly why an admin
// list can look empty when it shouldn't (RLS, schema drift, a missing migration).
export function LoadErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="mb-8 rounded-md border border-danger/30 bg-danger/5 p-4">
      <p className="text-sm font-semibold text-danger">
        No se pudieron cargar algunos datos
      </p>
      <ul className="mt-1 list-disc pl-5 font-mono text-xs text-fg-muted">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}
