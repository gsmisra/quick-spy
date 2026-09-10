---
id: requestbuilder-operation2-invocation
title: Invoke the `operation2` method on a `RequestBuilder` instance.
tags:
  - requestbuilder
  - api
  - rest
  - method-call
  - void
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RequestBuilder
sourcePath: src/main/java/com/framework/api/rest/RequestBuilder.java#operation2
sourceHash: 58324c991ccbabb43b78dcfb5f2b98d5a74af3d7e3a2bb0d07845fdb50373c97
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to explicitly trigger `operation2` on an already-created `RequestBuilder` instead of adding a custom helper.
Requires: An initialized `RequestBuilder` object in scope.
API: public void operation2()

```java
requestBuilder.operation2();
```
