import pytest

from core.entities.matching import AlignmentRequest
from env.tools.assignment import ScipyAssignmentTool


def test_finds_global_optimum_instead_of_greedy_matching():
    request = AlignmentRequest(
        "crossed", ((0.9, 0.8), (0.85, 0.1)), ("a", "b"), ("c", "d")
    )
    result = ScipyAssignmentTool().assign((request,))[0]

    assert result.pairs == ((0, 1), (1, 0))
    assert sum(
        request.weights[row][column] for row, column in result.pairs
    ) == pytest.approx(1.65)


def test_rectangular_assignment_never_reuses_a_child():
    request = AlignmentRequest(
        "rectangle", ((0.9,), (0.8,), (0.7,)), ("a", "b", "c"), ("d",)
    )
    result = ScipyAssignmentTool().assign((request,))[0]

    assert result.pairs == ((0, 0),)


def test_empty_assignment_is_supported():
    request = AlignmentRequest("empty", (), (), ("a",))

    assert ScipyAssignmentTool().assign((request,))[0].pairs == ()


@pytest.mark.parametrize("weights", [((float("nan"),),), ((1.1,),), ((0.2, 0.5),)])
def test_invalid_matrices_are_rejected(weights):
    with pytest.raises(ValueError):
        ScipyAssignmentTool().assign(
            (AlignmentRequest("invalid", weights, ("a",), ("b",)),)
        )
