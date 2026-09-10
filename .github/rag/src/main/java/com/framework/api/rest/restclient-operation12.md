---
id: operation12-restclient-invocation
title: Calls RestClient.operation12 to trigger the operation12 API-side action.
tags:
  - restclient
  - api
  - method-call
  - java
  - internal-library
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation12
sourceHash: 531b7a3619ff4c47e2d11a92e88dc05930cfdf846e55af99612b03aaccd9bf30
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RestClient` capability named `operation12` directly instead of creating a new helper path.
Requires: A `RestClient` instance is already created and accessible to the caller.
API: public void operation12()

```java
restClient.operation12();
```
