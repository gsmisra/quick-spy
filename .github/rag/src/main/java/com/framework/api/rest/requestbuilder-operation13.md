---
id: requestbuilder-operation13-invoke
title: Invoke RequestBuilder.operation13 on an existing RequestBuilder instance.
tags:
  - requestbuilder
  - api
  - method-call
  - java
  - smoke
  - internal-library
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RequestBuilder
sourcePath: src/main/java/com/framework/api/rest/RequestBuilder.java#operation13
sourceHash: 72b3bcec6bb5d6f79323d0442d50eecedc7a03799e89975b7cf87a7cc7b8ec07
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to trigger the built-in `operation13` behavior on `RequestBuilder` without adding helper code.
Requires: An already instantiated `RequestBuilder` object in scope.
API: public void operation13()

```java
requestBuilder.operation13();
```
