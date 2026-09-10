---
id: apitestdatabuilder-initialize
title: Initializes an `ApiTestDataBuilder` instance for API test data setup.
tags:
  - api
  - rest
  - testdata
  - builder
  - initialize
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#initialize
sourceHash: ac975eef723125aedd8119bd1e64025d4add433ff1bcf5f22b8589fa37a797d2
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this at the start of API test-data preparation when using an existing `ApiTestDataBuilder` instance.
Requires: A constructed `ApiTestDataBuilder` object is available.
API: public void initialize()

```java
apiTestDataBuilder.initialize();
```
