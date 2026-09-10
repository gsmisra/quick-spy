---
id: response-validator-operation3-invoke
title: Invoke `operation3` on `ResponseValidator` to trigger its built-in operation-level validation hook behavior.
tags:
  - response
  - validator
  - api
  - rest
  - operation3
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation3
sourceHash: 131abec76fe560a1a37d15df2f0a899d2ef87c6a492ea8d45944e4c67b02f901
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to explicitly execute the `ResponseValidator` third operation hook instead of adding custom helper code.
Requires: An instantiated `ResponseValidator` object. No arguments or additional setup are required by this API.
API: public void operation3()

```java
new ResponseValidator().operation3();
```
