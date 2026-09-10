---
id: operation8-rest-client-invocation
title: Invoke `operation8` on `RestClient` as a no-argument API action that returns no value.
tags:
  - restclient
  - api
  - method-call
  - void
  - no-args
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation8
sourceHash: dd97729c599b12bdc1d81abc2843f8cc0ac73d440cdef9e943dbe3e7f3a633c6
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when test flow needs to trigger `RestClient.operation8()` directly instead of creating a new helper path.
Requires: An initialized `RestClient` instance in scope.
API: `public void operation8()`

```java
restClient.operation8();
```
