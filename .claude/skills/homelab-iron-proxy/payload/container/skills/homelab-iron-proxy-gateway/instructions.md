# Credentials and egress

Your traffic goes through the operator's Iron Proxy. It inserts API keys for you.
You have no keys, only a placeholder: do not search for keys and do not ask the user for them.
A 403 from the proxy means the destination is blocked: report the host and the error.
A 401 can mean that no key is configured for that service: report it, do not guess.
Never bypass the proxy or its CA. Run long commands in the background.
