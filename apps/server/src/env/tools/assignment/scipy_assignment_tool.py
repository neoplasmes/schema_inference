from collections.abc import Sequence
from math import isfinite

from scipy.optimize import linear_sum_assignment

from app.ports.tools import AssignmentTool
from core.entities.matching import AlignmentRequest, AlignmentResult


class ScipyAssignmentTool(AssignmentTool):
    def assign(
        self, requests: Sequence[AlignmentRequest]
    ) -> tuple[AlignmentResult, ...]:
        results: list[AlignmentResult] = []

        for request in requests:
            if len(request.weights) != len(request.left_slots) or any(
                len(row) != len(request.right_slots) for row in request.weights
            ):
                raise ValueError("Alignment matrix dimensions must match its slots.")

            if any(
                not isfinite(weight) or not 0 <= weight <= 1
                for row in request.weights
                for weight in row
            ):
                raise ValueError(
                    "Alignment weights must be finite scores between zero and one."
                )

            if not request.left_slots or not request.right_slots:
                results.append(AlignmentResult(request.request_id, ()))

                continue

            rows, columns = linear_sum_assignment(request.weights, maximize=True)
            pairs = tuple(
                (int(row), int(column))
                for row, column in zip(rows, columns, strict=True)
            )
            results.append(AlignmentResult(request.request_id, pairs))

        return tuple(results)
