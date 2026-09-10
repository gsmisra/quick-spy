---
id: operation9-invoke-api-test-data-builder
title: Invoke ApiTestDataBuilder operation9 for API test data setup flow signaling.
tags:
  - api
  - testdata
  - builder
  - operation9
  - helper
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation9
sourceHash: 6dc6e586f81f239f385ea81f8f5c920a6e79236bf996d61f6059f0ce80d964a4
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to trigger the `operation9` step exposed by `ApiTestDataBuilder` rather than creating a new helper path.
Requires: An initialized `ApiTestDataBuilder` instance is already available in the test context.
API: public void operation9()

```java
apiTestDataBuilder.operation9();
```
