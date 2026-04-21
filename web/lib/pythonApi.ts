type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function getPythonApiConfig() {
  const baseUrl = process.env.PYTHON_API_URL;
  if (!baseUrl) {
    throw new Error("PYTHON_API_URL is not configured");
  }
  return {
    baseUrl,
    apiKey: process.env.PYTHON_API_KEY || ""
  };
}

export async function callPythonApi<T>(path: string, payload: JsonValue): Promise<T> {
  const { baseUrl, apiKey } = getPythonApiConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {})
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { detail: raw || "Non-JSON response from Python API" };
  }

  if (!response.ok) {
    const detail = data?.detail || data?.error || "Python API request failed";
    throw new Error(String(detail));
  }
  return data as T;
}
