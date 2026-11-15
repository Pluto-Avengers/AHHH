"""The connection to the local language model (Ollama)."""

import os

DEFAULT_MODEL = os.environ.get("MARTIAL_MODEL", "llama3.2")
DEFAULT_HOST = os.environ.get("OLLAMA_HOST")  # None: the ollama package's default, http://localhost:11434


class OllamaClient:
    def __init__(self, model=DEFAULT_MODEL, host=DEFAULT_HOST):
        self.model = model
        self.host = host

    def _client(self):
        from ollama import Client  # imported here so the map code works without the package

        return Client(host=self.host) if self.host else Client()

    def chat(self, system, user, fmt=None):
        """One reply from the model. Raises if Ollama can't be reached."""
        response = self._client().chat(
            model=self.model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            format=fmt,
            options={"temperature": 0.1, "num_ctx": 8192},
            keep_alive="30m",  # stay loaded between questions (a cold start takes a while on CPU)
        )
        return response.message.content.strip()

    def status(self):
        """Is Ollama running, and is the model installed?"""
        try:
            names = [m.model for m in self._client().list().models]
            ok = any(n == self.model or n.split(":")[0] == self.model for n in names)
            return {"ollama": True, "model": self.model, "model_installed": ok}
        except Exception as e:  # noqa: BLE001  (any connection failure means offline)
            return {"ollama": False, "model": self.model, "error": str(e)}
