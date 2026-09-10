---
id: operation1-trigger-call
title: Invoke `operation1` on `ApiTestDataBuilder` to run its basic operation hook.
tags:
  - api
  - rest
  - builder
  - invocation
  - utility
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation1
sourceHash: a59681bbba0319516fec0e29918e885921afbbc505b54b833f7c46e7c2ebe294
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute the `ApiTestDataBuilder` `operation1` capability directly rather than creating a custom helper.
Requires: An instantiated `ApiTestDataBuilder` object.
API: public void operation1()

```java
new ApiTestDataBuilder().operation1();
```
