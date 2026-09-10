---
id: requestbuilder-operation3-call
title: Invoke RequestBuilder operation3 for API-layer execution in tests.
tags:
  - requestbuilder
  - operation3
  - api
  - java
  - method-call
  - internal-library
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RequestBuilder
sourcePath: src/main/java/com/framework/api/rest/RequestBuilder.java#operation3
sourceHash: fc5198245910d0ec635f68de073858922e445f70c8926a50f2509d4dfd6e85e6
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute the existing `RequestBuilder` capability directly instead of creating a new helper path for the same action.
Requires: A usable `RequestBuilder` instance in scope before invocation.
API: public void operation3()

```java
new RequestBuilder().operation3();
```
