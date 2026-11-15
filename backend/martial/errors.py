class AgentError(Exception):
    """A request Martial can't carry out; the message is shown to the user."""


class NeedsInfo(Exception):
    """Martial needs one more answer before he can carry out a request: a question for the user, the
    answers to offer as buttons, and what is missing ('route', 'distance' or 'places')."""

    def __init__(self, question, choices=(), need="places"):
        super().__init__(question)
        self.question = question
        self.choices = list(choices)
        self.need = need
