---
id: operation17-emit-runtime-message
title: Calls operation17 on ApiTestDataBuilder to emit its standard runtime message.
tags:
  - api
  - testdata
  - builder
  - logging
  - utility
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation17
sourceHash: fccaa6db34bf747debf4dc7fc7133c128e087712d152043e8e44688d3506d14e
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the predefined operation17 hook on API test data setup code.
Requires: An instantiated `ApiTestDataBuilder` object.
API: public void operation17()

```java
new ApiTestDataBuilder().operation17();
```
