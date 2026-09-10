---
id: api-test-data-builder-operation11
title: Call ApiTestDataBuilder operation11 as a predefined API test-data builder step.
tags:
  - api
  - rest
  - testdata
  - builder
  - operation11
  - logging
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation11
sourceHash: 2a3f5e958b697aa7b840c630cad44910b722fff3d876555767f14f5da85299d2
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test should invoke the existing `ApiTestDataBuilder` operation hook rather than adding a custom step.
Requires: A constructed `ApiTestDataBuilder` instance available to call; no arguments are required.
API: public void operation11()

```java
apiTestDataBuilder.operation11();
```
