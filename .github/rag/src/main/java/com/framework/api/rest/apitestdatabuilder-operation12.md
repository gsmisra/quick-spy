---
id: operation12-invoke-builder-operation
title: Invoke `operation12` on `ApiTestDataBuilder` to execute its built-in operation hook.
tags:
  - api
  - rest
  - testdata
  - builder
  - utility
  - operation12
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation12
sourceHash: 896b620876033ab167a739c1adbd5c21ab27b96335354c5686c76129a3568376
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to trigger the existing `ApiTestDataBuilder` operation entrypoint instead of adding a new helper.
Requires: A constructed `ApiTestDataBuilder` instance.
API: public void operation12()

```java
new ApiTestDataBuilder().operation12();
```
