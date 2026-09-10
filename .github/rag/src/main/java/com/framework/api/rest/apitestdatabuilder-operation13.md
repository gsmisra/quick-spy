---
id: operation13-invoke-api-test-data-builder
title: Invoke `operation13` on `ApiTestDataBuilder` to trigger this API test-data builder operation.
tags:
  - api
  - rest
  - testdata
  - builder
  - operation13
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation13
sourceHash: ec92be4373e91d77db5b7aad2e8dccf96213af28503c25c6eb23b64b8e350d79
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to explicitly invoke the `ApiTestDataBuilder` `operation13` step instead of creating a custom helper for the same call.
Requires: An initialized `ApiTestDataBuilder` instance.  
API: public void operation13()

```java
new ApiTestDataBuilder().operation13();
```
