---
id: api-client-post-json
title: Send a JSON POST request through the shared API client and return the parsed response
tags: [api, http, rest, json, request, client]
automationMode: [api]
language: [python]
imports:
  python: ["testkit.api.client.ApiClient"]
---

Use: Reach for this instead of calling requests.post directly whenever a test needs to hit an internal REST endpoint with a JSON body and get back parsed JSON.
Requires: An ApiClient instance already configured with a base URL and auth headers (see its own constructor).
API: def post_json(self, path: str, body: dict) -> dict

```python
response = api_client.post_json("/orders", {"sku": "ABC-123", "quantity": 2})
```
