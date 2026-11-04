"""LIVE demo: three deliberate embedding requests, without OCR, vision or storage."""

import sys

from processing.embedding_service import EmbeddingService, EmbeddingServiceError, cosine_similarity


def main() -> int:
    try:
        service = EmbeddingService()
        door = service.embed_frame("ROOM 205", ["door", "sign", "wall"],
                                   "A wooden door in a university corridor.")
        laptop = service.embed_frame(objects=["laptop", "keyboard", "desk"],
                                     caption="A laptop is placed on a desk.")
        query = service.embed_query("What was written on the classroom door?")
        for name, result in (("Door", door), ("Laptop", laptop), ("Query", query)):
            if result is None:
                raise ValueError("Demo metadata unexpectedly produced no description.")
            print(f"{name}: model={result.model}, dimensions={result.dimensions}, "
                  f"preview={result.embedding[:5]}")
        print(f"Frame vectors differ: {door.embedding != laptop.embedding}")
        door_score = cosine_similarity(query.embedding, door.embedding)
        laptop_score = cosine_similarity(query.embedding, laptop.embedding)
        print(f"Query / door cosine: {door_score:.6f}")
        print(f"Query / laptop cosine: {laptop_score:.6f}")
        print(f"Door ranks higher: {door_score > laptop_score}")
        print("Actual API measurements; ranking is not guaranteed or a probability.")
        return 0
    except (TypeError, ValueError, EmbeddingServiceError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
