import { render, screen, fireEvent } from '@testing-library/react';
import { GitCommit } from '../ide/sidebar/GitPanel/GitCommit';

beforeAll(()=>{ 
    global.alert = jest.fn();
})

const mockCommit = [
    { id:1,message: "Initial commit"},
    { id:2,message: "Added new feature"},
    { id:3,message: "Fixed bug"},
]

describe('GitCommit Component',()=>{ 
    test('renders GitCommit component',()=>{ 
        render(<GitCommit />);
        const commitButton = screen.getByRole('button', { name: /Commit/i });
        const commitInput = screen.getByPlaceholderText(/Enter commit message/i);
        expect(commitInput).toBeInTheDocument();
        expect(commitButton).toBeInTheDocument();
    })

    test('Check the checkbox is checked or not', () => {
  
        render(<GitCommit />);
  const commitSelect = screen.getByRole('checkbox');
  expect(commitSelect).not.toBeChecked();

  fireEvent.click(commitSelect);

  expect(commitSelect).toBeChecked();
}
);
   test('add a mock commit message', () => {
    render(<GitCommit />);
  

  const commitInput = screen.getByPlaceholderText(/Enter commit message/i);
  const commitSelect = screen.getByRole('checkbox');
  // Assert that the input is cleared after clicking the button  // Assert that the input is cleared after clicking the button
  expect(commitSelect).not.toBeChecked();  // Assert that the input is cleared after clicking the button
  // Assert that the input is cleared after clicking the button
  fireEvent.click(commitSelect);

  if(!commitSelect.checked){ 
      expect(global.alert).toBeCalledWith("Please select at least one file to commit.");
  }

  const randomMessage = mockCommit[Math.floor(Math.random() * mockCommit.length)].message;


  fireEvent.change(commitInput, { target: { value: randomMessage } });

  const commitButton = screen.getByRole('button', { name: /Commit/i });
  fireEvent.click(commitButton);

  expect(commitInput.value).toBe(randomMessage);
});

})
