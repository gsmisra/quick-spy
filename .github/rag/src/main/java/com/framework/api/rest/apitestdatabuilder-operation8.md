---
id: operation8-invoke-status-output
title: Invoke ApiTestDataBuilder operation8 to trigger its predefined operation step output.
tags:
  - api
  - builder
  - operation8
  - logging
  - utility
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation8
sourceHash: 351d005dc9ef984acfdc5c7ea323636eaedba2b9ed4d3661486d9bb8bca690a5
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to execute the existing `operation8` step on `ApiTestDataBuilder` rather than creating a new helper for it.
Requires: An initialized `ApiTestDataBuilder` instance to call the instance method.
API: public void operation8()

```java
apiTestDataBuilder.operation8();
```
