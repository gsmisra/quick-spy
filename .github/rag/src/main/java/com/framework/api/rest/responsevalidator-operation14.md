---
id: response-validator-operation14-log-call
title: Invoke `operation14` on `ResponseValidator` to emit its call-level validator trace message.
tags:
  - response
  - validator
  - logging
  - trace
  - api
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation14
sourceHash: 447db291bf812ea0a5c1c1e6e1631d31794246953abeeec76993a32f8c707d7b
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to trigger the `ResponseValidator` operation14 call path and observe its side-effect logging.
Requires: An initialized `ResponseValidator` instance is already available in the test context.
API: public void operation14()

```java
responseValidator.operation14();
```
