---
id: operation6-rest-client-invoke
title: Invoke the RestClient operation6 method to trigger its built-in operation hook.
tags:
  - restclient
  - api
  - method-call
  - java
  - internal-library
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation6
sourceHash: cc1222b844101df2ec9318ed415d91802a9c31e861cffdd77808abdc1e3a9bdf
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RestClient` operation6 capability directly instead of adding new helper code.
Requires: A constructed `RestClient` instance available in scope before calling this method.
API: public void operation6()

```java
restClient.operation6();
```
