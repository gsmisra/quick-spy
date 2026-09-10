---
id: apitestdatabuilder-operation2-invoke
title: Invoke the ApiTestDataBuilder operation2 method during API test setup or flow execution.
tags:
  - api
  - rest
  - builder
  - invocation
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation2
sourceHash: 35d822bb9c4141372733f047f449027c4b01ce9932a02f31c337d09682228b15
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute the existing `operation2` hook on `ApiTestDataBuilder` instead of creating a duplicate helper.
Requires: An instantiated `ApiTestDataBuilder` object must be available.
API: public void operation2()

```java
new ApiTestDataBuilder().operation2();
```
