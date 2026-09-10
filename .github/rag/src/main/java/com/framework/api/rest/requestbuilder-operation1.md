---
id: operation1-requestbuilder-trigger
title: Invoke `operation1` on `RequestBuilder` to run its built-in operation hook.
tags:
  - requestbuilder
  - api
  - rest
  - method-call
  - internal-library
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RequestBuilder
sourcePath: src/main/java/com/framework/api/rest/RequestBuilder.java#operation1
sourceHash: 0220c54599254e6c6c9dfb1d7421d2f1c13a4967842270ba6fd1757342fb51d0
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to explicitly trigger `RequestBuilder`’s `operation1` behavior instead of adding custom helper logic.
Requires: An existing `RequestBuilder` instance.
API: public void operation1()

```java
requestBuilder.operation1();
```
