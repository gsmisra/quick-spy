---
id: operation1-response-validator-invoke
title: Invoke the `operation1` method on `ResponseValidator` to trigger its built-in operation hook.
tags:
  - responsevalidator
  - operation1
  - rest
  - api
  - utility
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation1
sourceHash: 26154afd3e59042076dda86068f05c8f21b744a20b6568817791e545435f97ab
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute the existing `ResponseValidator` no-argument operation entrypoint instead of adding a new helper.
Requires: None.
API: public void operation1()

```java
new ResponseValidator().operation1();
```
