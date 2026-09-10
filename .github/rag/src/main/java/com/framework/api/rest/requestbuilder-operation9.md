---
id: operation9-requestbuilder-log-call
title: Calls `operation9` on `RequestBuilder` to emit its operation trace message.
tags:
  - requestbuilder
  - api
  - rest
  - logging
  - trace
  - method-call
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RequestBuilder
sourcePath: src/main/java/com/framework/api/rest/RequestBuilder.java#operation9
sourceHash: 628bff07263bd9dbd92e7935f13875139179a348cc43735c1e575a6205359071
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to trigger `RequestBuilder`'s operation9 side effect instead of adding custom logging code.
Requires: A constructed `RequestBuilder` instance.
API: public void operation9()

```java
requestBuilder.operation9();
```
