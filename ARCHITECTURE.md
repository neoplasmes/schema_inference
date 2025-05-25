# Backend Architecture:

The next folder structure example is followed in this project. This is a kind of "clean architecture":
```
src/
    main.py <——— composition root
--------------------------------------------------------
    core/
        entities/
            user.py
        processes/ <———————————— core business processes (e.g. (the most stupid eg on the Earth) — price calculation)
            do_something(/ or _proc.py)
        
--------------------------------------------------------
    app/
        use_cases/  <———————————— the so called SACRED BUSINESS LOGIC ffs.
            create_user_case.py
            create_user_error.py <———————————— all errors, related to this specific use case, are stacked in this file (also see notes on errors)

        workflows/ <———————————— a set of related consequetive use_cases, united in a one workflow. I mean something, what need a SAGA/Temporal/Cadence to be invloved. Needs more detalization.

        ports/
            repos/ <———— When we talk about repo, we intend the term to mean EXACTLY the set of data processing and accessing operations with pg/redis/cassandra/etc. 
                user_repo.py <———————————— interface/contract. Here must be defined a set of methods used to manipulate an entity or a SET of entities.

            tools/
                do_something_tool.py

            external_clients/
                payment_client.py

            uow/ uow (unit of work) = transaction boundary for a group/sequence of data modifications
                transaction_uow.py
                some_other_unit.py
--------------------------------------------------------
    env/
        (db|config or all together)/

        repos/  <———————————— concrete realisation, binded to concrete technology
            pg_user_repo.py

        tools/
            techonology_name_do_something_tool.py

        external_clients/  <———————————— when we have to call something external at all?? for example call other microservice or smth.
            http_payment_client.py
            grpc_payment_client.py

        workflows/
            temporal_some_workflow.py (or IDK)

        uow/ 
            pg_transaction_uow.py
            etc...
--------------------------------------------------------
    api/  <———————————— it's just all application entrypoints
        schemas/
            user.py
        http/
            user/
                get/ <——— get/post/etc folders can be ommited, but naming convention of files should be kept.
                    GET_users.py <——— thus, this is for GET api/users
                post/
                    POST_user.py <——— POST api/user
                    ...
                etc/...
                    METHODCAPITALIZED_route_name (route names should be written with undescores)
                user_router.py
            other_name/
                ...
                other_name_router.py
        websocket/
        jobs/
        (events|messages|etc)/
        etc..../
--------------------------------------------------------
    shared/ <———————————— every project should have its own "trash can"
        utils/
            date_utils.py
            piska_utils.py
            etc.....
```

We should be using dots (.) instead of _ in filenames, when we are logically distinguish the different purposes of the file. E.g. user.repo.ext instead of user_repository.ex; But create_user.use_case.ext. But NOT create_user.etx or create_user_use_case.ext. **BUT IN THIS PROJECT WE ARE WORKING ON PYTHON, WHERE DOTS ARE INTERPRETED AS FOLDERS, SO WE VERY UNFORTUNATELY MUST USE UNDERSCORE _____ instead of dots**

### A note on errors

- We always keep errors close to their entities/processes/use_cases/etc with the corresponding namin, e.g. something_smth_error.py.

### Dependency direction:
```
api -> app -> core
        ^      ^
        |      |
env -> app     |
 |             |
 --------------|
```

It means, that `env` is injected to `app`. `app` uses   `core/entities` and `processes` which are **STABLE** and injected `env/(repos|tools)` (through the connectors — *ports* (`app/ports/(repos|tools)`)).

And also core entities can be imported and used inside environment repos/tools.

it can be finalized as follow set of rules:

**Allowed**:
```
api -> app -> core

env -> app
env -> core

main is composition root:
main -> api
main -> app
main -> env
main -> core
```

**Disallowed**:
```
core -> app
core -> env
core -> api

app -> env
app -> api

env -> api
```

### A note on services/algorithms/tools distribution in env/core folders.

- different **BUSINESS RULES/algorithms** go to `core/processes` folder. E.g:
```
semantics_merge/
    strategy.py
    strategies/
        something.py
```
- different technical possibilities of approaching the same task go to `env/tools` folder. And there MUST be an interface for them in `app/ports`

Thus we have **business processes** (the sacred ones, defining the application) and **environment processes** (something, that has simply to be done and no matter how. well of course it matters, but i mean that realisation details are not so important from the *business logic's* point of view).

### A note on `core` and `app` difference:

- `core` — how our sibject area is working and organized logically/generally/be entities/by processes.
- `app` — how exactly APPLICATION works and what it exactly foes in different scenarios.

### A note on "where to put alghorithmic code???":
TODO: make it more concrete
```
is the operation useful outside a specific business domain?
|
|— NO
|  |
|  |— does it corresponds to a whole concrete business decision?
|  |  |
|  |  |—> core/processes
|  |
|  |— does it only help a specific business process?
|     |
|     | —> keep it inside that process file/folder in core
|
|— YES
   |
   |— is it a capability with different technical implementations which do not define business logic?
   |  |
   |  |—> app/ports/tools for interface and env/tools for implementation  
   |
   |— Is it just a plain transformation/extraction function
      |
      |—> shared
```

### A note on `use_cases` and `workflows` difference:

- use_case — one application operation
- workflow — long-running/distributed orchestration of multiple app operations
