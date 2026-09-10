---
id: operation10-call-trace
title: Call RequestBuilder.operation10 to trigger the operation10 request-building step trace output.
tags:
  - requestbuilder
  - api
  - rest
  - logging
  - trace
  - operation10
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RequestBuilder
sourcePath: src/main/java/com/framework/api/rest/RequestBuilder.java#operation10
sourceHash: ee4c1ae1df06b09374992eea5deba6d76a778082b03bbe4bdce4337e9d9b2a46
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the predefined `RequestBuilder` operation step directly instead of adding custom wrapper logic.
Requires: An initialized `RequestBuilder` instance available to call.
API: public void operation10()

```java
requestBuilder.operation10();
```
