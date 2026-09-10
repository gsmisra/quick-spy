---
id: requestbuilder-operation8-invoke
title: Call RequestBuilder operation8 on an existing request builder instance.
tags:
  - requestbuilder
  - api
  - rest
  - method-call
  - smoke
  - logging
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RequestBuilder
sourcePath: src/main/java/com/framework/api/rest/RequestBuilder.java#operation8
sourceHash: 3ab0d230c7ebe8ba9792d0c85d5ed9a89468f37851f58c630ad6531c464fdcb8
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the `operation8` capability directly instead of adding a new helper path.
Requires: An initialized `RequestBuilder` instance is available to the caller.
API: public void operation8()

```java
requestBuilder.operation8();
```
