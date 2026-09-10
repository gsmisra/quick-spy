---
id: operation7-console-call-marker
title: Invoke ApiTestDataBuilder operation7 to emit its call marker to standard output.
tags:
  - api
  - logging
  - console-output
  - test-data
  - helper
  - operation7
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation7
sourceHash: 1227ce222e84354896279736789fb1fe286c8fc29f43f9a50acbdb2775de67d4
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs the existing operation7 call marker behavior instead of writing custom output code.
Requires: An initialized `ApiTestDataBuilder` instance in scope.
API: public void operation7()

```java
apiTestDataBuilder.operation7();
```
