"""Public database/storage errors never include SQL parameters or passwords."""


class DatabaseError(RuntimeError):
    pass


class DatabaseConfigurationError(DatabaseError):
    pass


class DatabaseConnectionError(DatabaseError):
    pass


class RepositoryError(DatabaseError):
    pass


class DuplicateFrameError(RepositoryError):
    pass


class ImageStorageError(RepositoryError):
    pass


class StorageConsistencyError(RepositoryError):
    """A commit or filesystem outcome needs explicit local recovery."""
