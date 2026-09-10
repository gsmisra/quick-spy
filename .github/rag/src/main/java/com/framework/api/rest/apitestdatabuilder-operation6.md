---
id: apitestdatabuilder-operation6-call
title: Invoke operation6 on ApiTestDataBuilder to trigger its predefined API test-data step.
tags:
  - api
  - testdata
  - builder
  - operation6
  - logging
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation6
sourceHash: 70b7fcdc289bf9aef8a6515e8ea4f360a3f1f8cfa46d7901663d61b7889332b1
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Reach for this when test code should execute the existing `operation6` hook instead of creating a new helper path.
Requires: An initialized `ApiTestDataBuilder` instance available in scope.
API: public void operation6()

```java
apiTestDataBuilder.operation6();
```
