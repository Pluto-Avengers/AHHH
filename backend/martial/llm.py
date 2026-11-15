"""The connection to the language model (Ollama).

On a computer: the local Ollama server. On Vercel, or anywhere without one: Ollama's hosted API.
Set OLLAMA_API_KEY (from ollama.com/settings/keys) and MARTIAL_MODEL to a cloud model such as
gpt-oss:120b, and the same client talks to https://ollama.com instead.
"""

import os

CLOUD_HOST = "https://ollama.com"
CLOUD_TIMEOUT = 20  # seconds per model call
API_KEY = (os.environ.get("OLLAMA_API_KEY") or "").strip() or None
DEFAULT_MODEL = os.environ.get("MARTIAL_MODEL", "llama3.2")
# None: the ollama package's default, http://localhost:11434 (or Ollama's hosted API when a key is set)
DEFAULT_HOST = os.environ.get("OLLAMA_HOST") or (CLOUD_HOST if API_KEY else None)


class OllamaClient:
    def __init__(self, model=DEFAULT_MODEL, host=DEFAULT_HOST, api_key=API_KEY):
        self.model = model
        self.host = host
        self.api_key = api_key

    def _client(self):
        from ollama import Client  # imported here so the map code works without the package

        options = {}
        if self.host:
            options["host"] = self.host
        if self.api_key:
            options["headers"] = {"Authorization": f"Bearer {self.api_key}"}
            # Hosted API: give up on a slow reply so Martial can answer from the map data instead of
            # the whole request timing out (a Vercel Function is cut off after 60 s)
            options["timeout"] = CLOUD_TIMEOUT
        return Client(**options)

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
