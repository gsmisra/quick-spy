---
id: operation5-call-status-log
title: Call `operation5` to trigger the builder's operation-level status output.
tags:
  - api
  - rest
  - builder
  - logging
  - console
  - utility
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation5
sourceHash: 84cdf70a678b53f1343a6bd8dd88c866d23616000a9349360338403e7ffd395f
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the predefined `ApiTestDataBuilder` operation hook rather than adding custom helper logic.
Requires: An initialized `ApiTestDataBuilder` instance in scope before calling this method.
API: public void operation5()

```java
apiTestDataBuilder.operation5();
```
