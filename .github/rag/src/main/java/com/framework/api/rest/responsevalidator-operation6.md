---
id: operation6-response-validator-call-trace
title: Call ResponseValidator.operation6 to trigger the predefined operation6 validation step output.
tags:
  - api
  - rest
  - response
  - validator
  - method-call
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation6
sourceHash: efab2e31fbad2916552e46aefe4f6f395d882c79c2688d1b7a8545ebd8226a31
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `operation6` hook on `ResponseValidator` instead of creating a new helper.
Requires: An instantiated `ResponseValidator` object.
API: public void operation6()

```java
new ResponseValidator().operation6();
```
