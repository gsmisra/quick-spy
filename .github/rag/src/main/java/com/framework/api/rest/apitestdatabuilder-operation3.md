---
id: operation3-callable-noarg-method
title: Calls the `operation3` method on `ApiTestDataBuilder` with no arguments.
tags:
  - api
  - builder
  - method-call
  - no-args
  - smoke
  - logging
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation3
sourceHash: cf9eb9032cd5c5e69de60879bd86677faf33ed1a4756b2080bf61977c698cded
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke this existing no-argument builder operation instead of adding a new helper.
Requires: None.
API: public void operation3()

```java
new ApiTestDataBuilder().operation3();
```
