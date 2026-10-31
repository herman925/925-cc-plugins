"""Fail closed for the jev-router sentinel without opening a socket.

The pre-call callback rewrites jev-router onto an execute alias before this
handler runs. With the callback omitted, every completion method raises
CustomLLMError. There is no api_base and no connection attempt.
"""

from litellm.llms.custom_llm import CustomLLM, CustomLLMError

MESSAGE = (
    "sentinel_inert: jev-router has no execute route until the pre-call hook rewrites the model."
)


class InertSentinel(CustomLLM):
    def completion(self, *args, **kwargs):
        raise CustomLLMError(status_code=400, message=MESSAGE)

    def streaming(self, *args, **kwargs):
        raise CustomLLMError(status_code=400, message=MESSAGE)

    async def acompletion(self, *args, **kwargs):
        raise CustomLLMError(status_code=400, message=MESSAGE)

    async def astreaming(self, *args, **kwargs):
        raise CustomLLMError(status_code=400, message=MESSAGE)


proxy_handler_instance = InertSentinel()
