---
id: operation4-console-call-marker
title: Invoke `operation4` on `ApiTestDataBuilder` to emit its operation-level call marker.
tags:
  - api
  - rest
  - builder
  - logging
  - trace
  - smoke
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation4
sourceHash: fd3f71bd11e460ad28648a763f611f201343f31207d9d355ab5987eed5c31ee8
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to trigger `ApiTestDataBuilder` operation flow and record that `operation4` was invoked, instead of adding custom helper code.
Requires: An instantiated `ApiTestDataBuilder` object in scope.
API: public void operation4()

```java
apiTestDataBuilder.operation4();
```
