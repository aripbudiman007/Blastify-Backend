/**
 * Substitute {{variable}} placeholders in a template string.
 *
 * Built-in variables always available:
 *   {{name}}   {{phone}}   {{date}}   {{time}}   {{datetime}}
 *
 * Custom variables come from Contact.variables (JSON object).
 *
 * Example:
 *   template = "Halo {{name}}, kode Anda: {{code}}"
 *   vars     = { name: "Budi", phone: "6281...", code: "ABC123" }
 *   result   = "Halo Budi, kode Anda: ABC123"
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | undefined | null> = {},
): string {
  const now = new Date();
  const builtIn: Record<string, string> = {
    date: now.toLocaleDateString('id-ID'),
    time: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    datetime: now.toLocaleString('id-ID'),
  };

  const merged = { ...builtIn, ...vars };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = merged[key];
    return val != null ? String(val) : `{{${key}}}`;
  });
}

/** Check whether a string contains template variables */
export function hasVariables(str: string): boolean {
  return /\{\{\w+\}\}/.test(str);
}

// ─── Webhook payload template rendering ──────────────────────────────────────

/**
 * Get a nested value from an object using dot-notation path.
 * Supports array index access: "line_items.0.name"
 */
function getNestedValue(obj: any, path: string): string | undefined {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = Array.isArray(current) ? current[Number(part)] : current[part];
  }
  return current != null ? String(current) : undefined;
}

/**
 * Render a template with dot-notation support against a raw webhook payload.
 * Variables are written as {{field}} or {{customer.name}} or {{line_items.0.price}}.
 * Built-in variables: {{date}}, {{time}}, {{datetime}}
 */
export function renderWebhookTemplate(template: string, payload: Record<string, any>): string {
  const now = new Date();
  const builtIn: Record<string, string> = {
    date: now.toLocaleDateString('id-ID'),
    time: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    datetime: now.toLocaleString('id-ID'),
  };

  return template.replace(/\{\{([\w.[\]]+)\}\}/g, (_, key: string) => {
    if (builtIn[key] !== undefined) return builtIn[key];
    const val = getNestedValue(payload, key);
    return val != null ? val : `{{${key}}}`;
  });
}

/**
 * Extract a phone number from a nested payload object using dot-notation path.
 * Returns null if path not found or value is empty.
 */
export function extractPhoneFromPayload(payload: any, path: string): string | null {
  const raw = getNestedValue(payload, path);
  if (!raw) return null;
  // Strip non-numeric except leading +
  const cleaned = raw.replace(/[^0-9+]/g, '');
  return cleaned.length >= 7 ? cleaned : null;
}
