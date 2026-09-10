---
id: operation13-call-log
title: Calls RestClient.operation13 to trigger its operation-level diagnostic output.
tags:
  - restclient
  - api
  - diagnostics
  - logging
  - void
  - operation13
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation13
sourceHash: 790da7cf6e156cd860fc1c707d60830e81c53c4768e8f9066b84904c016a77de
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the predefined `RestClient` operation13 endpoint hook instead of adding a custom helper.
Requires: An initialized `RestClient` instance is available to call.
API: public void operation13()

```java
restClient.operation13();
```
